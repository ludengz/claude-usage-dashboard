import { Router } from 'express';
import { parseLogDirectory } from '../parser.js';
import { filterByDateRange, autoGranularity, aggregateByTime, aggregateBySession, aggregateByProject, aggregateByModel, aggregateCache } from '../aggregator.js';
import { calculateRecordCost, PLAN_DEFAULTS } from '../pricing.js';

export function createApiRouter(logBaseDir) {
  const router = Router();
  let allRecords = [];
  try {
    allRecords = parseLogDirectory(logBaseDir);
    console.log(`Parsed ${allRecords.length} records from ${logBaseDir}`);
  } catch (err) {
    console.error('Failed to parse log directory:', err.message);
  }

  function applyFilters(query) {
    let records = filterByDateRange(allRecords, query.from, query.to);
    if (query.project) records = records.filter(r => r.project === query.project);
    if (query.model) records = records.filter(r => r.model === query.model);
    return records;
  }

  router.get('/usage', (req, res) => {
    try {
      const records = applyFilters(req.query);
      const granularity = req.query.granularity || autoGranularity(req.query.from, req.query.to);
      const buckets = aggregateByTime(records, granularity);
      const total = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, estimated_api_cost_usd: 0 };
      for (const r of records) {
        total.input_tokens += r.input_tokens; total.output_tokens += r.output_tokens;
        total.cache_read_tokens += r.cache_read_tokens; total.cache_creation_tokens += r.cache_creation_tokens;
        total.estimated_api_cost_usd += calculateRecordCost(r);
      }
      total.estimated_api_cost_usd = Math.round(total.estimated_api_cost_usd * 100) / 100;
      res.json({ granularity, buckets, total });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'PARSE_ERROR' });
    }
  });

  router.get('/models', (req, res) => { res.json({ models: aggregateByModel(applyFilters(req.query)) }); });
  router.get('/projects', (req, res) => { res.json({ projects: aggregateByProject(applyFilters(req.query)) }); });

  router.get('/sessions', (req, res) => {
    const records = applyFilters(req.query);
    let sessions = aggregateBySession(records);
    const sort = req.query.sort || 'date';
    const order = req.query.order || 'desc';
    const sortFn = { date: (a, b) => new Date(b.startTime) - new Date(a.startTime), cost: (a, b) => b.estimated_cost_usd - a.estimated_cost_usd, tokens: (a, b) => b.total_tokens - a.total_tokens }[sort] || ((a, b) => new Date(b.startTime) - new Date(a.startTime));
    sessions.sort(sortFn);
    if (order === 'asc') sessions.reverse();
    const totalTokens = sessions.reduce((sum, s) => sum + s.total_tokens, 0);
    const totalCost = sessions.reduce((sum, s) => sum + s.estimated_cost_usd, 0);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const totalSessions = sessions.length;
    const totalPages = Math.ceil(totalSessions / limit);
    sessions = sessions.slice((page - 1) * limit, page * limit);
    res.json({ sessions, pagination: { page, limit, total_sessions: totalSessions, total_pages: totalPages }, totals: { total_tokens: totalTokens, estimated_cost_usd: Math.round(totalCost * 100) / 100 } });
  });

  router.get('/cost', (req, res) => {
    const records = applyFilters(req.query);
    const plan = req.query.plan || 'max5x';
    const customPrice = req.query.customPrice ? parseFloat(req.query.customPrice) : null;
    const subscriptionCost = customPrice || PLAN_DEFAULTS[plan] || 100;
    let apiCost = 0;
    for (const r of records) apiCost += calculateRecordCost(r);
    apiCost = Math.round(apiCost * 100) / 100;
    const dayMap = new Map();
    for (const r of records) { const day = r.timestamp.slice(0, 10); dayMap.set(day, (dayMap.get(day) || 0) + calculateRecordCost(r)); }
    const costPerDay = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, cost]) => {
      const d = new Date(date);
      const daysInMonth = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getUTCDate();
      return { date, api_cost: Math.round(cost * 100) / 100, subscription_daily: Math.round((subscriptionCost / daysInMonth) * 100) / 100 };
    });
    const savings = apiCost - subscriptionCost;
    res.json({ plan, subscription_cost_usd: subscriptionCost, api_equivalent_cost_usd: apiCost, savings_usd: Math.round(savings * 100) / 100, savings_percent: apiCost > 0 ? Math.round((savings / apiCost) * 1000) / 10 : 0, cost_per_day: costPerDay });
  });

  router.get('/cache', (req, res) => { res.json(aggregateCache(applyFilters(req.query))); });
  return router;
}

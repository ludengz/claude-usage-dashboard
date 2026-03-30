import { calculateRecordCost } from './pricing.js';

/**
 * Pure computation: given records (already filtered to a cycle) and quota data,
 * compute actual tokens/cost and project at 100% utilization.
 */
export function computeCycleData(records, quotaData) {
  const overallUtil = quotaData.seven_day?.utilization || 0;
  const opusUtil = quotaData.seven_day_opus?.utilization || 0;
  const sonnetUtil = quotaData.seven_day_sonnet?.utilization || 0;

  let totalTokens = 0, totalCost = 0;
  let opusTokens = 0, opusCost = 0;
  let sonnetTokens = 0, sonnetCost = 0;

  for (const r of records) {
    const tokens = r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens;
    const cost = calculateRecordCost(r);
    totalTokens += tokens;
    totalCost += cost;

    if (r.model?.includes('opus')) {
      opusTokens += tokens;
      opusCost += cost;
    } else if (r.model?.includes('sonnet')) {
      sonnetTokens += tokens;
      sonnetCost += cost;
    }
  }

  totalCost = Math.round(totalCost * 100) / 100;
  opusCost = Math.round(opusCost * 100) / 100;
  sonnetCost = Math.round(sonnetCost * 100) / 100;

  function project(actual, utilization) {
    if (utilization <= 0) return null;
    return Math.round(actual / (utilization / 100));
  }

  function projectCost(actual, utilization) {
    if (utilization <= 0) return null;
    return Math.round((actual / (utilization / 100)) * 100) / 100;
  }

  return {
    overall: {
      utilization: overallUtil,
      actualTokens: totalTokens,
      projectedTokensAt100: project(totalTokens, overallUtil),
      actualCost: totalCost,
      projectedCostAt100: projectCost(totalCost, overallUtil),
    },
    models: {
      opus: {
        utilization: opusUtil,
        actualTokens: opusTokens,
        projectedTokensAt100: project(opusTokens, opusUtil),
        actualCost: opusCost,
        projectedCostAt100: projectCost(opusCost, opusUtil),
      },
      sonnet: {
        utilization: sonnetUtil,
        actualTokens: sonnetTokens,
        projectedTokensAt100: project(sonnetTokens, sonnetUtil),
        actualCost: sonnetCost,
        projectedCostAt100: projectCost(sonnetCost, sonnetUtil),
      },
    },
  };
}

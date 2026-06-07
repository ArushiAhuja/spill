import { query } from './db.js';

export async function getOrgFeatures(orgId) {
  const { rows } = await query(
    'SELECT features FROM organizations WHERE id = $1',
    [orgId]
  );
  return rows[0]?.features || {};
}

export function isMmtOrg(features) {
  return features?.mmt === true;
}

export function computeCustomerLabels({ follower_count, verified_handle, mention_count }) {
  const labels = [];

  if (mention_count > 15) {
    labels.push('Detractor');
  } else if (mention_count > 10) {
    labels.push('Imminent Detractor');
  }

  if (follower_count > 2500) {
    labels.push('High Influencer');
  }

  if (verified_handle === true) {
    labels.push('Verified');
  }

  return labels;
}

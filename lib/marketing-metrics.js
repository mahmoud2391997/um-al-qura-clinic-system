// Linked journey stages are authoritative; manual legacy conversions remain identified.
export async function marketingMetrics(db, campaignId) {
  const leads = await db
    .prepare('SELECT id,campaign_id,status FROM leads')
    .all();
  const visits = new Map(
    (await db.prepare('SELECT lead_id,stage FROM lead_visits').all()).map(
      (r) => [r.lead_id, r.stage],
    ),
  );
  const selected =
    campaignId === undefined
      ? leads
      : leads.filter((r) => r.campaign_id === campaignId);
  const linked = selected.filter((r) => visits.has(r.id));
  const attended = linked.filter((r) =>
    ['Attended', 'ReviewRequested'].includes(visits.get(r.id)),
  ).length;
  const legacy = selected.filter(
    (r) => !visits.has(r.id) && r.status === 'Converted',
  ).length;
  return {
    inquiries: selected.length,
    booked: linked.length,
    attended,
    review_requests: linked.filter(
      (r) => visits.get(r.id) === 'ReviewRequested',
    ).length,
    legacy_converted: legacy,
    converted: linked.length + legacy,
    conversion: selected.length
      ? (linked.length + legacy) / selected.length
      : 0,
  };
}

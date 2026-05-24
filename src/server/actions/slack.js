export async function sendSlack(post, category, config) {
  const webhookUrl = config?.webhook_url || config?.slack_webhook_url;
  if (!webhookUrl) throw new Error('Slack webhook URL not configured');

  const score = post.escalation_score || 0;
  const color = score >= 80 ? '#f87171' : score >= 60 ? '#818cf8' : '#3b82f6';
  const tags = [];
  if (post.is_competitor) tags.push(`competitor: ${post.competitor_name}`);
  if (post.is_influencer) tags.push('influencer');

  const payload = {
    attachments: [{
      color,
      title: (post.title || '(no title)').slice(0, 150),
      title_link: post.url || undefined,
      text: [
        post.reasoning || '',
        tags.length ? `\n_${tags.join(' · ')}_` : '',
        post.response_template ? `\n\n*Suggested response:*\n${post.response_template}` : '',
      ].filter(Boolean).join(''),
      fields: [
        { title: 'Source', value: post.source, short: true },
        { title: 'Category', value: category?.name || 'Uncategorized', short: true },
        { title: 'Score', value: `${score}/100`, short: true },
        { title: 'Author', value: post.author || 'unknown', short: true },
      ],
      footer: 'Spill Social Watch',
      ts: Math.floor(new Date(post.post_created_at || Date.now()) / 1000),
    }],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Slack error ${res.status}: ${text.slice(0, 200)}`);
  }

  console.log(`[slack] alert sent for post ${post.id}`);
}

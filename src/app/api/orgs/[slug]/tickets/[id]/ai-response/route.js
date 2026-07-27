import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';
import { createEventTrace } from '../../../../../../../server/observability.js';
import { composePrompt } from '../../../../../../../server/prompt-composer.js';
import { getOrganizationAgentConfig } from '../../../../../../../server/organization-agent-config.js';

const PERSONALITIES = {
  professional: 'formal, empathetic, solution-focused corporate tone',
  friendly: 'warm, conversational, casual but still helpful',
  apologetic: 'highly empathetic, prioritizes acknowledging the issue and apologizing sincerely',
  assertive: 'confident, direct, brief — acknowledges the issue and states next steps clearly',
};

// POST /api/orgs/[slug]/tickets/[id]/ai-response
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { personality = 'professional', instructions, iterations = 3 } = await request.json();

    const { rows: [ticket] } = await query(
      `SELECT t.*, o.id as organization_id, o.name as org_name, o.description as org_description, o.website, o.competitors, o.partner_brands, o.organization_profile, o.intel_profile
       FROM tickets t JOIN organizations o ON o.id = t.org_id
       WHERE t.id = $1 AND t.org_id = $2`,
      [id, access.orgId]
    );
    if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 });

    const { rows: notes } = await query(
      `SELECT body, is_internal FROM ticket_notes WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 });

    const openai = new OpenAI({ apiKey });

    const toneDesc = PERSONALITIES[personality] || PERSONALITIES.professional;
    const previousNotes = notes.filter(n => !n.is_internal).map(n => n.body).join('\n---\n');
    const agentConfig = await getOrganizationAgentConfig(access.orgId, 'response_writer');
    const organization = { id: ticket.organization_id, name: ticket.org_name, description: ticket.org_description, website: ticket.website, competitors: ticket.competitors, partner_brands: ticket.partner_brands, organization_profile: ticket.organization_profile, intel_profile: ticket.intel_profile };
    const composition = await composePrompt({
      agentName: 'response_writer', orgId: access.orgId, organization, agentConfig, model: 'gpt-4o-mini',
      runtimeContext: {
        tone: toneDesc, special_instructions: instructions || null,
        customer_complaint: { title: ticket.title, body: ticket.body || null, author: ticket.author || null, author_handle: ticket.author_handle || null },
        previous_public_replies: previousNotes || null,
        output_rules: `Generate ${Math.min(iterations, 5)} distinct response options. Return only a JSON array of strings.`,
      },
    });

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        { role: 'system', content: composition.systemPrompt },
        { role: 'user', content: composition.userPrompt },
      ],
    });

    let responses;
    try {
      const raw = res.choices[0].message.content.trim();
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      responses = jsonMatch ? JSON.parse(jsonMatch[0]) : [raw];
    } catch {
      responses = [res.choices[0].message.content.trim()];
    }

    const traceId = await createEventTrace({ orgId: access.orgId, post: { id: ticket.id, source: ticket.source || 'ticket', title: ticket.title, body: ticket.body, detected_query: 'ticket response generation' }, quality: { relevance: 1, confidence: 1, score: 100 }, decision: 'response_generated', promptVersions: { response_writer: composition.prompt.version }, observations: [{ name: 'Response Writer Agent', kind: 'agent', model: 'gpt-4o-mini', promptKey: 'response_writer', promptVersion: composition.prompt.version, input: { prompt_id: composition.prompt.id, prompt_hash: composition.promptHash, ticket_id: ticket.id, personality }, output: { response_count: responses.length }, latencyMs: null, inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens, promptSnapshot: { key: 'response_writer', id: composition.prompt.id, content: composition.systemPrompt }, configSnapshot: { organization_intelligence: composition.organizationIntelligence } }] });
    return NextResponse.json({ responses, personality, trace_id: traceId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

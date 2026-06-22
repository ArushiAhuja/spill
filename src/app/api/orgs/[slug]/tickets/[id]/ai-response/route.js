import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';

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
      `SELECT t.*, o.name as org_name, o.description as org_description, o.intel_profile
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
    const intel = ticket.intel_profile || {};
    const brandContext = intel.brandVoice || '';
    const icpContext = intel.icpDescription || '';
    const typicalComplaints = intel.typicalComplaints?.slice(0, 5).join('; ') || '';
    const previousNotes = notes.filter(n => !n.is_internal).map(n => n.body).join('\n---\n');

    const systemPrompt = `You are a social media customer support agent for ${ticket.org_name}.
${ticket.org_description ? `About the company: ${ticket.org_description}` : ''}
${icpContext ? `Who our customers are: ${icpContext}` : ''}
${brandContext ? `Brand voice: ${brandContext}` : ''}
${typicalComplaints ? `Common issues we handle: ${typicalComplaints}` : ''}
Tone: ${toneDesc}
${instructions ? `Special instructions: ${instructions}` : ''}

Write a public-facing customer response. Keep it under 280 characters if channel is Twitter/social media. Be specific, don't use canned phrases. Resolve or clearly state next steps.`;

    const userPrompt = `Customer complaint/query:
Title: ${ticket.title}
${ticket.body ? `Content: ${ticket.body}` : ''}
${ticket.author ? `From: ${ticket.author}${ticket.author_handle ? ` (@${ticket.author_handle})` : ''}` : ''}
${previousNotes ? `\nPrevious replies:\n${previousNotes}` : ''}

Generate ${Math.min(iterations, 5)} distinct response options. Return as a JSON array of strings.`;

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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

    return NextResponse.json({ responses, personality });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

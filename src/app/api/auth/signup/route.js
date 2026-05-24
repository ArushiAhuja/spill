import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../../../server/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'spill_dev_secret_change_in_prod';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export async function POST(request) {
  try {
    const { name, email, password } = await request.json();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'valid email is required' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 });
    }

    const password_hash = await bcrypt.hash(password, 10);

    let rows;
    try {
      const result = await query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
        [name.trim(), email.toLowerCase().trim(), password_hash]
      );
      rows = result.rows;
    } catch (err) {
      if (err.code === '23505') {
        return NextResponse.json({ error: 'email already in use' }, { status: 409 });
      }
      throw err;
    }

    const user = rows[0];
    const token = signToken(user);
    return NextResponse.json(
      { token, user: { id: user.id, email: user.email, name: user.name } },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

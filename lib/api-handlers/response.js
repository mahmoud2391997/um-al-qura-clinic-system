import { publicError } from '../public-errors.js';
import { NextResponse } from 'next/server';
export const response = (payload, status = 200) =>
  NextResponse.json(
    payload?.error
      ? { ...payload, error: publicError(payload.error) }
      : payload,
    {
      status,
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
    },
  );

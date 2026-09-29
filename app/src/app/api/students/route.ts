import { NextResponse } from 'next/server';
import { studentsData } from '@/lib/students';

export async function GET() {
  return NextResponse.json(studentsData);
}

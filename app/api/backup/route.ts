import { listBackups, backupDatabase } from '@/lib/db/backup';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(listBackups());
}

export async function POST() {
  const result = await backupDatabase();
  return Response.json(result, { status: 201 });
}

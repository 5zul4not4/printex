import { getPrintJobsByStatus } from '@/lib/firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { FilePenLine, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default async function EditRequestsPage() {
  const jobs = await getPrintJobsByStatus('pending');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FilePenLine className="w-5 h-5 text-muted-foreground" />
          <CardTitle>Edit & Print Requests</CardTitle>
        </div>
        <CardDescription>These jobs are waiting for an admin to review and edit them before printing.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job ID</TableHead>
              <TableHead>File Name</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24">No pending edit requests.</TableCell>
              </TableRow>
            )}
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs">{job.id.substring(0, 8)}...</TableCell>
                <TableCell>{job.fileName}</TableCell>
                <TableCell>₹{job.cost.toFixed(2)}</TableCell>
                <TableCell>{format(new Date(job.createdAt), 'PPpp')}</TableCell>
                <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/edit-requests/${job.id}`}>
                            Review & Edit
                            <ChevronRight className="w-4 h-4 ml-2" />
                        </Link>
                    </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

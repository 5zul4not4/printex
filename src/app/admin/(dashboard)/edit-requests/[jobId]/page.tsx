import { getPrintJobById } from '@/lib/firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default async function EditRequestDetailPage({ params }: { params: { jobId: string } }) {
  const job = await getPrintJobById(params.jobId);

  if (!job) {
    notFound();
  }

  return (
    <div className="space-y-6">
        <Link href="/admin/edit-requests" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back to Edit Requests
        </Link>

        <Card>
            <CardHeader>
                <CardTitle>Edit Job: {job.id.substring(0, 8)}...</CardTitle>
                <CardDescription>
                    File: <span className="font-medium text-foreground">{job.fileName}</span>
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-muted-foreground">Status</p>
                        <Badge variant="outline" className="capitalize mt-1">{job.status}</Badge>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Created At</p>
                        <p className="mt-1">{format(new Date(job.createdAt), 'PPpp')}</p>
                    </div>
                     <div>
                        <p className="text-muted-foreground">Print Type</p>
                        <p className="mt-1 capitalize">{job.printType}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Copies</p>
                        <p className="mt-1">{job.copies}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Page Count</p>
                        <p className="mt-1">{job.pageCount}</p>
                    </div>
                     <div>
                        <p className="text-muted-foreground">Cost</p>
                        <p className="mt-1 font-semibold">₹{job.cost.toFixed(2)}</p>
                    </div>
                </div>

                <div className="mt-6">
                    <h3 className="font-semibold mb-2">Document Editor</h3>
                    <div className="border rounded-lg bg-muted/30 p-4 h-64 flex items-center justify-center">
                        <p className="text-muted-foreground">Document editing feature coming soon...</p>
                    </div>
                </div>
            </CardContent>
            <CardFooter className="justify-end gap-2">
                <Button variant="outline">Reject</Button>
                <Button>Approve & Send to Print</Button>
            </CardFooter>
        </Card>
    </div>
  );
}

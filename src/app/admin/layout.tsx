'use client';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';


export default function AdminLayout({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Simple hardcoded password check
    if (password === 'ridha123') {
      toast({ title: 'Login Successful' });
      setIsAuthenticated(true);
    } else {
      const genericError = "Invalid password."
      setError(genericError);
      toast({ variant: 'destructive', title: 'Login Failed', description: genericError });
      setIsLoading(false);
      setPassword('');
    }
  };


  if (!isAuthenticated) {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
           <div className="absolute top-8 left-8 flex items-center gap-2 text-xl font-bold">
             <Printer className="h-6 w-6 text-primary" />
             <span>PrintEase Admin</span>
           </div>
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Admin Access</CardTitle>
              <CardDescription>Enter the password to continue.</CardDescription>
            </CardHeader>
            <form onSubmit={handleLogin}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-center text-destructive">{error}</p>}
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign In
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      );
  }

  return <>{children}</>;
}

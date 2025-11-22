import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Printer, UploadCloud } from 'lucide-react';
import Image from 'next/image';
import { PlaceHolderImages } from '@/lib/placeholder-images';

export default function Home() {
  const heroImage = PlaceHolderImages.find(img => img.id === 'hero');

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-card border-b">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center">
          <Printer className="h-6 w-6 text-primary" />
          <h1 className="ml-2 text-xl font-bold font-headline">Printel</h1>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative w-full h-[50vh] min-h-[400px] flex items-center justify-center text-center text-white">
          {heroImage && (
            <Image
              src={heroImage.imageUrl}
              alt={heroImage.description}
              fill
              className="object-cover"
              data-ai-hint={heroImage.imageHint}
              priority
            />
          )}
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative z-10 p-4">
            <h2 className="text-4xl md:text-5xl font-bold font-headline">Effortless Printing, Instantly</h2>
            <p className="mt-4 text-lg md:text-xl max-w-2xl mx-auto">Upload your documents and get your prints without the wait.</p>
          </div>
        </section>

        <section className="py-12 md:py-20 bg-background">
          <div className="container mx-auto px-4 md:px-6 text-center">
            <UploadCloud className="mx-auto h-16 w-16 text-primary" />
            <h3 className="text-3xl font-bold font-headline mt-6">Get Started Now</h3>
            <p className="mt-2 text-muted-foreground max-w-xl mx-auto">Ready to print? Click the button below to upload your document and send it directly to the printer.</p>
            <div className="mt-8">
              <Button asChild size="lg">
                <Link href="/order">
                  Print a Document
                </Link>
              </Button>
            </div>
            <div className="mt-8 flex justify-end">
              <Link href="/admin" className="text-muted-foreground hover:text-foreground font-mono text-lg">
                admin
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-card border-t">
        <div className="container mx-auto px-4 md:px-6 py-4 text-center text-muted-foreground text-sm">
          © 2024 PrintEase. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

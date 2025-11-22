
'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { getPricing, updatePricing, getPaperSizes, updatePaperSizes } from '@/lib/firebase/actions';
import type { Pricing, PaperSizes } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Settings } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

const settingsSchema = z.object({
  // Pricing
  bwA4First10Pages: z.coerce.number().min(0),
  bwA4First10Price: z.coerce.number().min(0),
  bwA4After10Price: z.coerce.number().min(0),
  coverPageFee: z.coerce.number().min(0),
  colorA4Price: z.coerce.number().min(0),
  bwA3Price: z.coerce.number().min(0),
  colorA3Price: z.coerce.number().min(0),
  bwA2Price: z.coerce.number().min(0),
  colorA2Price: z.coerce.number().min(0),
  bwA1Price: z.coerce.number().min(0),
  colorA1Price: z.coerce.number().min(0),
  bwA0Price: z.coerce.number().min(0),
  colorA0Price: z.coerce.number().min(0),
  spiralBindingFee: z.coerce.number().min(0),
  softBindingFee: z.coerce.number().min(0),
  editFee: z.coerce.number().min(0),
  // Paper Sizes
  A0: z.boolean(),
  A1: z.boolean(),
  A2: z.boolean(),
  A3: z.boolean(),
  A4: z.boolean(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
        bwA4First10Pages: 10,
        bwA4First10Price: 2,
        bwA4After10Price: 1,
        coverPageFee: 2,
        colorA4Price: 10,
        bwA3Price: 10,
        colorA3Price: 30,
        bwA2Price: 0,
        colorA2Price: 0,
        bwA1Price: 0,
        colorA1Price: 0,
        bwA0Price: 0,
        colorA0Price: 0,
        spiralBindingFee: 40,
        softBindingFee: 25,
        editFee: 15,
        A0: false,
        A1: false,
        A2: true,
        A3: true,
        A4: true,
    },
  });

  useEffect(() => {
    async function loadSettings() {
      setIsLoading(true);
      try {
        const [pricingData, paperSizesData] = await Promise.all([
            getPricing(),
            getPaperSizes()
        ]);
        form.reset({ ...pricingData, ...paperSizesData });
      } catch (error) {
        console.error("Error loading settings:", error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not load existing settings.' });
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, [form, toast]);

  async function onSubmit(values: SettingsFormValues) {
    const pricingValues: Pricing = {
        bwA4First10Pages: Number(values.bwA4First10Pages),
        bwA4First10Price: Number(values.bwA4First10Price),
        bwA4After10Price: Number(values.bwA4After10Price),
        coverPageFee: Number(values.coverPageFee),
        colorA4Price: Number(values.colorA4Price),
        bwA3Price: Number(values.bwA3Price),
        colorA3Price: Number(values.colorA3Price),
        bwA2Price: Number(values.bwA2Price),
        colorA2Price: Number(values.colorA2Price),
        bwA1Price: Number(values.bwA1Price),
        colorA1Price: Number(values.colorA1Price),
        bwA0Price: Number(values.bwA0Price),
        colorA0Price: Number(values.colorA0Price),
        spiralBindingFee: Number(values.spiralBindingFee),
        softBindingFee: Number(values.softBindingFee),
        editFee: Number(values.editFee),
    };

    const paperSizeValues: PaperSizes = {
        A0: values.A0,
        A1: values.A1,
        A2: values.A2,
        A3: values.A3,
        A4: values.A4,
    };

    const updatePromises = [
        updatePricing(pricingValues),
        updatePaperSizes(paperSizeValues)
    ];

    const results = await Promise.all(updatePromises);
    const failedResult = results.find(r => !r.success);

    if (failedResult) {
        console.error("Firebase update error:", failedResult.message);
        toast({
            variant: "destructive",
            title: "Error Saving Settings",
            description: failedResult.message || "Could not update some settings.",
        });
    } else {
        toast({
            title: "Settings Saved",
            description: "Your new settings have been saved successfully.",
        });
    }
  }

  const paperSizeOptions: (keyof PaperSizes)[] = ['A4', 'A3', 'A2', 'A1', 'A0'];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Pricing &amp; Service Settings</CardTitle>
        </div>
        <CardDescription>Manage your print shop pricing, fees, and other service settings.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-8">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-lg font-medium">B/W Printing (A4)</h3>
                  <p className="text-sm text-muted-foreground">Define tiered pricing for black and white A4 prints.</p>
                  <Separator className="my-2" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <FormField control={form.control} name="bwA4First10Pages" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pages for First Tier</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="bwA4First10Price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price for First Tier (per page)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="bwA4After10Price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price After First Tier (per page)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium">A3 Printing</h3>
                   <p className="text-sm text-muted-foreground">Set the price for A3 B/W and A3 Color prints.</p>
                  <Separator className="my-2" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <FormField control={form.control} name="bwA3Price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>A3 B/W Price (per page)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="colorA3Price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>A3 Color Price (per page)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium">Color Printing (A4)</h3>
                   <p className="text-sm text-muted-foreground">Set the price for A4 Color prints.</p>
                  <Separator className="my-2" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                     <FormField control={form.control} name="colorA4Price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>A4 Color Price (per page)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium">Large Format Printing</h3>
                  <p className="text-sm text-muted-foreground">Set prices for large format prints based on color type.</p>
                  <Separator className="my-2" />
                  <div className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormLabel className="md:col-span-1 pt-2">A2 Price</FormLabel>
                        <FormField control={form.control} name="bwA2Price" render={({ field }) => (<FormItem><FormControl><Input type="number" step="0.01" placeholder="B/W Price" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="colorA2Price" render={({ field }) => (<FormItem><FormControl><Input type="number" step="0.01" placeholder="Color Price" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormLabel className="md:col-span-1 pt-2">A1 Price</FormLabel>
                        <FormField control={form.control} name="bwA1Price" render={({ field }) => (<FormItem><FormControl><Input type="number" step="0.01" placeholder="B/W Price" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="colorA1Price" render={({ field }) => (<FormItem><FormControl><Input type="number" step="0.01" placeholder="Color Price" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormLabel className="md:col-span-1 pt-2">A0 Price</FormLabel>
                        <FormField control={form.control} name="bwA0Price" render={({ field }) => (<FormItem><FormControl><Input type="number" step="0.01" placeholder="B/W Price" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="colorA0Price" render={({ field }) => (<FormItem><FormControl><Input type="number" step="0.01" placeholder="Color Price" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium">Available Paper Sizes</h3>
                  <p className="text-sm text-muted-foreground">Select which paper sizes are available for customers to order.</p>
                  <Separator className="my-2" />
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                    {paperSizeOptions.map((size) => (
                      <FormField
                        key={size}
                        control={form.control}
                        name={size}
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>{size}</FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium">Additional Fees</h3>
                  <p className="text-sm text-muted-foreground">Fees for cover pages, binding, and other services.</p>
                  <Separator className="my-2" />
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <FormField control={form.control} name="coverPageFee" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cover Page Fee</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                     <FormField control={form.control} name="spiralBindingFee" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Spiral Binding Fee</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                     <FormField control={form.control} name="softBindingFee" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Soft Binding Fee</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="editFee" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Edit Service Fee</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={form.formState.isSubmitting || isLoading}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Settings
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

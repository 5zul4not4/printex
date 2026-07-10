'use server';

/**
 * @fileOverview Summarizes the edits made by an admin to a document.
 *
 * - summarizeAdminEdits - A function that summarizes the edits made by an admin.
 * - SummarizeAdminEditsInput - The input type for the summarizeAdminEdits function.
 * - SummarizeAdminEditsOutput - The return type for the summarizeAdminEdits function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeAdminEditsInputSchema = z.object({
  originalText: z
    .string()
    .describe('The original text content of the document before edits.'),
  editedText: z
    .string()
    .describe('The edited text content of the document after admin edits.'),
});
export type SummarizeAdminEditsInput = z.infer<typeof SummarizeAdminEditsInputSchema>;

const SummarizeAdminEditsOutputSchema = z.object({
  summary: z
    .string()
    .describe('A concise summary of the changes made to the document.'),
});
export type SummarizeAdminEditsOutput = z.infer<typeof SummarizeAdminEditsOutputSchema>;

export async function summarizeAdminEdits(input: SummarizeAdminEditsInput): Promise<SummarizeAdminEditsOutput> {
  return summarizeAdminEditsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeAdminEditsPrompt',
  input: {schema: SummarizeAdminEditsInputSchema},
  output: {schema: SummarizeAdminEditsOutputSchema},
  prompt: `You are an expert document editor. You will summarize the changes made to a document.

Original Text: {{{originalText}}}
Edited Text: {{{editedText}}}

Summary:`,
});

const summarizeAdminEditsFlow = ai.defineFlow(
  {
    name: 'summarizeAdminEditsFlow',
    inputSchema: SummarizeAdminEditsInputSchema,
    outputSchema: SummarizeAdminEditsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

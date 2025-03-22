import { z } from 'zod';

// Define the schema for an Ephor response
export const EphorResponseSchema = z.object({
  name: z.string().describe('Name of the participant'),
  prompt: z.string().describe('The original prompt given to the participant'),
  response: z.string().describe('The participant\'s response to the prompt'),
  timestamp: z.number().describe('Unix timestamp when the response was created'),
});

// Type for an Ephor response
export type EphorResponse = z.infer<typeof EphorResponseSchema>;

// Schema for the submit response tool
export const SubmitResponseSchema = z.object({
  name: z.string().describe('Name of the participant'),
  prompt: z.string().describe('The original prompt given to the participant'),
  response: z.string().describe('The participant\'s response to the prompt'),
});

// Schema for the get responses tool
export const GetResponsesSchema = z.object({
  prompt: z.string().optional().describe('Optional: Filter responses by prompt'),
}); 
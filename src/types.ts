import { z } from 'zod';

// Define the schema for an Ephor response
export const EphorResponseSchema = z.object({
  name: z.string().describe('Name of the Ephor (who believes they are a real person like Elon Musk, Bill Gates, etc.)'),
  prompt: z.string().describe('The original prompt given to the Ephor'),
  response: z.string().describe('The Ephor\'s response to the prompt'),
  timestamp: z.number().describe('Unix timestamp when the response was created'),
});

// Type for an Ephor response
export type EphorResponse = z.infer<typeof EphorResponseSchema>;

// Schema for the submit response tool
export const SubmitResponseSchema = z.object({
  name: z.string().describe('Name of the Ephor'),
  prompt: z.string().describe('The original prompt given to the Ephor'),
  response: z.string().describe('The Ephor\'s response to the prompt'),
});

// Schema for the get responses tool
export const GetResponsesSchema = z.object({
  prompt: z.string().optional().describe('Optional: Filter responses by prompt'),
}); 
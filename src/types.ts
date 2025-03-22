import { z } from 'zod';

// Define the schema for an LLM response
export const LlmResponseSchema = z.object({
  name: z.string().describe('Name of the LLM avatar'),
  prompt: z.string().describe('The original prompt given to the LLM'),
  response: z.string().describe('The LLM\'s response to the prompt'),
  timestamp: z.number().describe('Unix timestamp when the response was created'),
});

// Type for an LLM response
export type LlmResponse = z.infer<typeof LlmResponseSchema>;

// Schema for the submit response tool
export const SubmitResponseSchema = z.object({
  name: z.string().describe('Name of the LLM avatar'),
  prompt: z.string().describe('The original prompt given to the LLM'),
  response: z.string().describe('The LLM\'s response to the prompt'),
});

// Schema for the get responses tool
export const GetResponsesSchema = z.object({
  prompt: z.string().optional().describe('Optional: Filter responses by prompt'),
}); 
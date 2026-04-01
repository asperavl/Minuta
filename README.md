# Minuta - Meeting Intelligence Hub

## The Problem
Tracking issues, action items, and topic history across multiple sequential meetings is a difficult and error-prone process. Standard summarization tools analyze single meetings in isolation and struggle to monitor the full, continuous lifecycle of ongoing issues (raised, resolved, reopened, obsoleted) throughout a project's timeline.

## The Solution
Minuta solves this challenge by functioning as an event-sourced meeting pipeline. Using deterministic LLM extraction and reconciliation, it processes meeting transcripts chronologically. It accurately tracks action items, maps out issue lifecycles dynamically across multiple meetings, and provides an intelligent chat interface built with project-wide context.

## Tech Stack
- **Programming Languages**: TypeScript, JavaScript
- **Frameworks**: Next.js, React
- **Databases**: PostgreSQL (via Supabase)
- **APIs and Third-Party Tools**:
  - Groq API (LLaMA models for data extraction and text reconciliation)
  - Supabase Edge Functions
  - Tailwind CSS, shadcn/ui
  - lucide-react, recharts

## Setup Instructions

### 1. Install Dependencies
Navigate into the project directory and install the necessary packages using npm:
```bash
npm install
```

### 2. Configure Environment Variables
You will need to set up your environment variables for local development. Create a `.env.local` file in the root directory and ensure the following keys are provided:
- Supabase Project URL (`NEXT_PUBLIC_SUPABASE_URL`)
- Supabase Anon Key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- Groq API Key (`GROQ_API_KEY`)

### 3. Supabase Backend Setup
Minuta utilizes Supabase for PostgreSQL databases and Edge Functions. Make sure you have the [Supabase CLI](https://supabase.com/docs/guides/cli) installed.

To link to your remote project and apply migrations:
```bash
npx supabase login
npx supabase link --project-ref <your-project-id>
npx supabase db push
```

Alternatively, if running locally without a remote link:
```bash
npx supabase start
```

### 4. Deploy Edge Functions
The processing pipeline relies on Supabase Edge Functions. Deploy them to your environment:
```bash
npx supabase functions deploy process-transcript --no-verify-jwt
npx supabase functions deploy reconcile-project --no-verify-jwt
```
*(Note: adjust the `--no-verify-jwt` flag depending on your specific auth configuration).*

### 5. Run the Project Locally
Start the Next.js development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

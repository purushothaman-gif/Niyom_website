// Shared types for marketing content generation.
//
// These mirror the shapes `mkt-generate-content` has always produced. They are
// stated here rather than imported from the frontend's marketingTypes.ts on
// purpose: the edge functions and the app are separate TypeScript programs with
// separate tsconfigs, and a cross-tree import would make the app's build a
// dependency of the functions' typecheck.

/** A compliance or structural finding against a draft. */
export interface Flag {
  field: string;
  phrase: string;
  label: string;
}

/**
 * The generated draft.
 *
 * Deliberately `Record<string, unknown>`-friendly: it arrives as parsed JSON
 * from the model and is handed straight back to the caller, so the lint pass
 * reads fields defensively rather than trusting the shape.
 */
export interface Draft {
  title: string;
  headline: string;
  body: string;
  caption: string;
  hashtags: string[];
  cta: string;
  seo_keywords: string[];
  suggested_post_time: string;
  platform_optimisation: {
    instagram: string | null;
    facebook: string | null;
    linkedin: string | null;
  };
  slides: { heading: string; body: string }[] | null;
  video_script: { scene: string; text: string; duration_seconds: number }[] | null;
}

/** What the caller asks for. The HTTP layer coerces the request body into this. */
export interface Brief {
  category: string;
  topic?: string;
  content_type?: string;
  platforms?: string[];
  tone?: string;
  extra_instructions?: string;
  regenerate_of_content_no?: string;
  slide_count?: number;
  video_duration_seconds?: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface GenerateResult {
  draft: Record<string, unknown>;
  flags: Flag[];
  usage?: Usage;
  model: string;
}

/** One sanitised news headline, used only as evidence of what is topical. */
export interface TrendItem {
  title: string;
  source: string;
}

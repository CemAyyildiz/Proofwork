import "server-only";
import { cache } from "react";
import { publicCampaign } from "@/services/submission";

/** One read per request, shared by the layout, metadata and page. */
export const campaignFor = cache((slug: string) => publicCampaign(slug));

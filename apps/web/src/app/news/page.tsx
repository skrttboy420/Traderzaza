import { DEFAULT_WATCHLIST } from "@atc/market-data";

import { NewsView } from "./NewsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The calendar as its own destination, because that is how the user actually
 * reads news: open the calendar first, see what is coming today, then decide
 * whether to look for a setup at all.
 *
 * The page itself fetches nothing. The panel loads per symbol from
 * `/api/news`, so switching markets does not re-render the server page and the
 * response cache in `lib/news.ts` is shared across symbols.
 */
export default function NewsPage() {
  return <NewsView symbols={[...DEFAULT_WATCHLIST]} />;
}

import { GuideView } from "./GuideView";

/**
 * §86: the app has to be usable without someone standing next to you
 * explaining it. This page is that someone.
 *
 * It is static text, so it can be rendered once at build time — there is no
 * market data on it and nothing to revalidate.
 */
export default function GuidePage() {
  return <GuideView />;
}

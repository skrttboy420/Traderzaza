// eslint-config-next 16 ships native flat configs, so there is no FlatCompat
// shim here any more. `core-web-vitals` already includes the base Next rules;
// `typescript` adds the TS-aware ones.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // These three come from the React Compiler lint pass, which ships enabled
      // in Next 16 even when the compiler itself is off (it is off here — there
      // is no `reactCompiler` in next.config.ts). They are real advice, not
      // false positives, but they are advice about a refactor rather than about
      // a bug, so they are warnings and not a build gate:
      //
      //   refs             — the replay trainer keeps its ReplayController in a
      //                      ref and reads it inside useMemo to re-run the
      //                      engine on the revealed slice. The controller is a
      //                      deliberately mutable imperative object; moving it
      //                      into state would re-create it on every candle.
      //   set-state-in-effect — `lib/store.ts` and the i18n provider hydrate
      //                      from localStorage in an effect, because
      //                      localStorage does not exist during SSR. Setting
      //                      state once after mount is the point.
      //   purity           — same hydration story, read during a render path.
      //
      // Written down rather than silenced, so the debt stays visible.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];

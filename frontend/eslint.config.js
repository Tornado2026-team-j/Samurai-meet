// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // eslint-config-expo@57 enables React Compiler diagnostics by default.
    // This app is not compiled with React Compiler yet and intentionally uses
    // mutable refs for latest event state plus effects for async loading.
    // Keep the existing lint contract until those patterns are migrated.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  }
]);

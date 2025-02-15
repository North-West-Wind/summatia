// @ts-check

import eslint from "@eslint/js";
import importSort from "eslint-plugin-simple-import-sort";
import unusedImport from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default tseslint.config(
	eslint.configs.recommended,
	tseslint.configs.recommended,
	{
		plugins: {
			"unused-imports": unusedImport,
			"import-sort": importSort
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"unused-imports/no-unused-imports": "error",
			"unused-imports/no-unused-vars": [
				"warn",
				{
					"vars": "all",
					"varsIgnorePattern": "^_",
					"args": "after-used",
					"argsIgnorePattern": "^_",
				},
			],
			"import-sort/imports": "error",
			"import-sort/exports": "error",
		}
	},
	{
		ignores: ["dist/", "runtime/"]
	}
);
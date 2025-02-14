// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import unusedImport from "eslint-plugin-unused-imports";

export default tseslint.config(
	eslint.configs.recommended,
	tseslint.configs.recommended,
	{
		plugins: {
			"unused-imports": unusedImport
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
			]
		}
	},
	{
		ignores: ["dist/"]
	}
);
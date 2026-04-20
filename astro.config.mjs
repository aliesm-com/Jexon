// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
const base = process.env.PUBLIC_BASE_PATH ?? '/';

export default defineConfig({
	output: 'static',
	base,
});

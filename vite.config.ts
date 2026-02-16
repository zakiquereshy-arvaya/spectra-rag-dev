import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		allowedHosts: ['6bee-2601-740-8001-c240-15d7-1e72-f14f-f3b5.ngrok-free.app'],
	},
});

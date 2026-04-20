const CACHE_NAME = 'jexon-pwa-v1';
const APP_SHELL = ['/', '/about/', '/offline.html', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(APP_SHELL);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigationRequest(request));
		return;
	}

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(handleAssetRequest(request));
});

async function handleNavigationRequest(request) {
	try {
		const response = await fetch(request);
		const cache = await caches.open(CACHE_NAME);
		cache.put(request, response.clone());
		return response;
	} catch {
		return (await caches.match(request)) || (await caches.match('/offline.html'));
	}
}

async function handleAssetRequest(request) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);

	const isStaticAsset = ['script', 'style', 'image', 'font'].includes(request.destination);
	if (isStaticAsset && cached) {
		void fetchAndCache(request, cache);
		return cached;
	}

	try {
		const response = await fetch(request);
		if (response && response.status === 200 && response.type === 'basic') {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		return cached || Response.error();
	}
}

async function fetchAndCache(request, cache) {
	try {
		const response = await fetch(request);
		if (response && response.status === 200 && response.type === 'basic') {
			await cache.put(request, response.clone());
		}
	} catch {
		/* ignore */
	}
}

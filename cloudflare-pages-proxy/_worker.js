const SCOUT_ORIGIN = 'https://scout.jarinaremar13.workers.dev';

export default {
  async fetch(request) {
    const publicUrl = new URL(request.url);
    const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, SCOUT_ORIGIN);
    const headers = new Headers(request.headers);

    headers.set('x-forwarded-host', publicUrl.host);
    headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));

    const upstream = await fetch(
      new Request(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      }),
    );

    const responseHeaders = new Headers(upstream.headers);
    const location = responseHeaders.get('location');
    if (location?.startsWith(SCOUT_ORIGIN)) {
      responseHeaders.set('location', `${publicUrl.origin}${location.slice(SCOUT_ORIGIN.length)}`);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};

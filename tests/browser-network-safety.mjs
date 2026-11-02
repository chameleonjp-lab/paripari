// Only the test server's static GET/HEAD requests may reach a network.
// Register explicit complete RPC mocks after this route so they fulfill locally.
export async function isolateBrowserNetwork(context, baseURL) {
  const base = new URL(baseURL);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password) throw Error('Expected the local fixture server origin');
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request();
    if (new URL(request.url()).origin !== base.origin || !['GET', 'HEAD'].includes(request.method())) return route.abort('blockedbyclient');
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 2 });
    if (response.status() >= 300 && response.status() < 400) {
      await route.abort();
      throw Error('Unexpected local redirect blocked');
    }
    await route.fulfill({ response });
  });
}

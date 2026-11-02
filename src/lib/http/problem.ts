export function problem(status: 404 | 503, requestId: string): Response {
  const notFound = status === 404;
  return Response.json(
    {
      type: "about:blank",
      title: notFound ? "No encontrado" : "Servicio no disponible",
      status,
      code: notFound ? "NOT_FOUND" : "UNAVAILABLE",
      detail: notFound
        ? "El recurso solicitado no está disponible."
        : "Intentá nuevamente más tarde.",
      request_id: requestId,
    },
    {
      status,
      headers: {
        "Content-Type": "application/problem+json",
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

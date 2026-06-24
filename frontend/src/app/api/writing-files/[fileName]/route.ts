import type { NextRequest } from "next/server";

const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "http://127.0.0.1:8002";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;
  const backendUrl = new URL(`/api/writing/files/${fileName}`, BACKEND_BASE_URL);

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");

  const response = await fetch(backendUrl, {
    method: "GET",
    headers,
  });

  // 透传 Content-Type 让浏览器正确识别图片格式
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: { "Content-Type": contentType },
  });
}

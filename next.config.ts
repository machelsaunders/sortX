import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // The local embedding model (transformers.js + onnxruntime) ships native
  // binaries and must not be bundled by Next.js.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.twimg.com',
      },
    ],
  },
}

export default nextConfig

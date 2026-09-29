import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: {
      // Importação de XML TISS: até 12 arquivos de ~1 MB por envio.
      bodySizeLimit: '15mb',
    },
  },
};

export default nextConfig;

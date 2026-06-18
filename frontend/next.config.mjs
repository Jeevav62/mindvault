/** @type {import('next').NextConfig} */
const nextConfig = {
  // Move .next outside OneDrive — OneDrive cannot handle Next.js symlinks (EINVAL readlink).
  // C:\Users\jeevarathinam\rag-next is outside the synced folder so symlinks work fine.
  distDir: "C:\\Users\\jeevarathinam\\rag-next",
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Move .next outside OneDrive — OneDrive cannot handle Next.js symlinks (EINVAL readlink).
  // Relative path: frontend/ → Proj-rag/ → Desktop/ → OneDrive/ → user home → rag-next
  // Resolves to C:\Users\jeevarathinam\rag-next which is outside OneDrive sync.
  distDir: "../../../../rag-next",
};
export default nextConfig;

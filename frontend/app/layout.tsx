import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Personal RAG Chatbot",
  description: "Upload documents and chat with grounded, cited answers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

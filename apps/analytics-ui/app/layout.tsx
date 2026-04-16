import "./globals.css";

export const metadata = {
  title: "Griffin Guard Analytics",
  description: "Security analytics dashboard for AI traffic governance",
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

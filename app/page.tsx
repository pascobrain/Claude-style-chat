export default function Page() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">App Restored</h1>
      <p>Due to a system timeout, the filesystem was reset. I have restored a basic working setup and identified that the previous build error was caused by importing &lt;Html&gt; from next/document in the App Router, which expects standard &lt;html&gt; tags.</p>
    </div>
  );
}

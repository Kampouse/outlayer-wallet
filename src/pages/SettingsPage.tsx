import MobileHeader from '@/components/MobileHeader'

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <MobileHeader />
      <main className="pb-20">
        <div className="max-w-lg mx-auto px-4 pt-4">
          <h1 className="text-lg font-semibold mb-4">Settings</h1>
        </div>
      </main>
    </div>
  )
}

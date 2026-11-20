import { redirect } from 'next/navigation'

/** The Follow Ups tab became the Action Centre (2026-11). Old links and bookmarks land there. */
export default function FollowUpRedirect() {
    redirect('/insurance/dashboard/action-centre')
}

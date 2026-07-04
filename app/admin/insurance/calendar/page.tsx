'use client'

import CalendarAdminView from '@/components/insurance/calendar/CalendarAdminView'

// Admin QA console for the Economic Calendar. FOMC + CPI values are fully
// automated; this screen is for the occasional CPI-dates ICS import, adding
// MAS MPS dates, and hide/edit/delete overrides.
export default function AdminInsuranceCalendarPage() {
    return <CalendarAdminView />
}

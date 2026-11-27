import { describe, it, expect } from 'vitest'
import {
    AUTO_REMARKS, autoRemark, needsFollowUp, addMonths, addDays, daysBetween,
    defaultClosedWonFollowUp, defaultNewCaseFollowUp, caseLockInEnd, followUpLimit, followUpBucket, reminderDue,
} from '../followUps'

describe('auto remarks', () => {
    it('match the wording agreed with the business (mirrored in SQL)', () => {
        expect(AUTO_REMARKS).toEqual({
            'Touched Base': 'Engage Prospect',
            'Pending Docs': 'Obtain Documents',
            'IPA': 'Obtain IPA',
            'Pending Approval': 'Check Approval',
            'Pending Signature': 'Facilitate Signing',
            'Closed Won': 'Closed Won Previously. To Revisit',
            'Closed Lost': 'Closed Lost Previously. To Revisit',
        })
        expect(autoRemark('Inactive')).toBe('')
    })
})

describe('needsFollowUp', () => {
    it('every named case needs a date', () => {
        expect(needsFollowUp({ stage: 'Pending Docs', client_name: 'A' })).toBe(true)
        expect(needsFollowUp({ stage: 'Closed Won', client_name: 'A' })).toBe(true)
        expect(needsFollowUp({ stage: 'Pending Docs', client_name: 'A', follow_up_date: '2026-12-01' })).toBe(false)
    })
    it('only Closed Lost can opt out, and drafts are exempt', () => {
        expect(needsFollowUp({ stage: 'Closed Lost', client_name: 'A', no_follow_up: true })).toBe(false)
        expect(needsFollowUp({ stage: 'Pending Docs', client_name: 'A', no_follow_up: true })).toBe(true)
        expect(needsFollowUp({ stage: 'Touched Base', client_name: '  ' })).toBe(false)
    })
})

describe('date helpers', () => {
    it('add months clamping to month end, and days across years', () => {
        expect(addMonths('2026-08-31', -6)).toBe('2026-02-28')
        expect(addMonths('2026-11-20', 21)).toBe('2028-08-20')
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
        expect(daysBetween('2026-11-17', '2026-11-20')).toBe(3)
    })
})

describe('defaults', () => {
    it('closed won: 3 months before lock-in ends, else 2 years', () => {
        expect(defaultClosedWonFollowUp('2026-11-20', '2028-11-20', '2026-11-20')).toBe('2028-08-20')
        expect(defaultClosedWonFollowUp('2026-11-20', null, '2026-11-20')).toBe('2028-11-20')
        // A backdated close whose lead date has passed lands tomorrow, not overdue.
        expect(defaultClosedWonFollowUp('2020-01-01', '2021-01-01', '2026-11-20')).toBe('2026-11-21')
    })
    it('new case: 3 months before a future lock-in end, else today', () => {
        expect(defaultNewCaseFollowUp('2027-06-30', '2026-11-20')).toBe('2027-03-30')
        expect(defaultNewCaseFollowUp('2027-01-15', '2026-11-20')).toBe('2026-11-20')
        expect(defaultNewCaseFollowUp(null, '2026-11-20')).toBe('2026-11-20')
    })
})

describe('followUpBucket', () => {
    it('splits overdue / today / next 14 days / later with no overlap', () => {
        const t = '2026-11-20'
        expect(followUpBucket('2026-11-19', t)).toBe('overdue')
        expect(followUpBucket('2026-11-20', t)).toBe('today')
        expect(followUpBucket('2026-12-04', t)).toBe('soon')     // day 14
        expect(followUpBucket('2026-12-05', t)).toBe('later')    // day 15
    })
})

describe('reminderDue — client is contacted only on Closed Won + consent', () => {
    const base = {
        stage: 'Closed Won', client_reminder_opt_in: true, follow_up_date: '2026-11-20',
        client_reminder_sent_for: null, client_email: 'a@b.co', client_mobile: null,
    }
    const t = '2026-11-20'
    it('sends on the date', () => expect(reminderDue(base, t)).toBe(true))
    it('never for other stages or without the box ticked', () => {
        expect(reminderDue({ ...base, stage: 'Pending Docs' }, t)).toBe(false)
        expect(reminderDue({ ...base, stage: 'Closed Lost' }, t)).toBe(false)
        expect(reminderDue({ ...base, client_reminder_opt_in: false }, t)).toBe(false)
    })
    it('once per date, re-armed when the date moves', () => {
        expect(reminderDue({ ...base, client_reminder_sent_for: '2026-11-20' }, t)).toBe(false)
        expect(reminderDue({ ...base, client_reminder_sent_for: '2024-11-20' }, t)).toBe(true)
    })
    it('not early, catches up 3 days late, then gives up', () => {
        expect(reminderDue(base, '2026-11-19')).toBe(false)
        expect(reminderDue(base, '2026-11-23')).toBe(true)
        expect(reminderDue(base, '2026-11-24')).toBe(false)
    })
    it('needs an email or mobile', () => {
        expect(reminderDue({ ...base, client_email: '' }, t)).toBe(false)
        expect(reminderDue({ ...base, client_email: '', client_mobile: '91234567' }, t)).toBe(true)
    })
})

describe('lock-in limit: no later than 2 months before lock-in ends', () => {
    const won = { stage: 'Closed Won', lock_in_end_date: '2026-12-01', closed_won_data: { closed_at: '2026-11-20', package: { lockin_years: 2 }, lock_in_end_date: '2028-12-27' } }
    it('uses the lock-in entered at closing, not the old loan or the estimate', () => {
        expect(caseLockInEnd(won)).toBe('2028-12-27')
        expect(followUpLimit(won, '2026-11-24')).toBe('2028-10-27')
    })
    it('falls back to closing date + years for older closures', () => {
        expect(caseLockInEnd({ ...won, closed_won_data: { closed_at: '2026-11-20', package: { lockin_years: 2 } } })).toBe('2028-11-20')
    })
    it('lifts on the day it arrives, so a later date can still be saved', () => {
        expect(followUpLimit(won, '2028-10-26')).toBe('2028-10-27')
        expect(followUpLimit(won, '2028-10-27')).toBeNull()
    })
    it('covers Inactive, never open stages or a case with no lock-in', () => {
        expect(followUpLimit({ stage: 'Inactive', lock_in_end_date: '2027-04-30' }, '2026-11-24')).toBe('2027-02-28')
        expect(followUpLimit({ stage: 'Pending Docs', lock_in_end_date: '2027-04-30' }, '2026-11-24')).toBeNull()
        expect(followUpLimit({ stage: 'Pending Docs', lock_in_end_date: '2027-04-30' }, '2026-11-24', 'Inactive')).toBe('2027-02-28')
        expect(followUpLimit({ stage: 'Inactive' }, '2026-11-24')).toBeNull()
    })
})

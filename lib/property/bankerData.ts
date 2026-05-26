export type CaseCategory = 'residential' | 'commercial'

export const BANKER_DATA: Record<string, Record<CaseCategory, string[]>> = {
    'DBS': {
        residential: ['Terence Lee Tze Ghee', 'Low Siying', 'Dylan Wong'],
        commercial: ['Ciran', 'Jackie'],
    },
    'UOB': {
        residential: ['Anjelica Hu', 'Jason Goh'],
        commercial: ['Shanu', 'Yasir'],
    },
    'OCBC': {
        residential: ['Stella Tan', 'Rayner Teh'],
        commercial: ['Aaron'],
    },
    'SCB': {
        residential: ['Chan Ying Feng'],
        commercial: [],
    },
    'Maybank': {
        residential: ['Kervelle Ang'],
        commercial: [],
    },
    'BOC': {
        residential: ['Loy Pue Jung'],
        commercial: [],
    },
    'HSBC': {
        residential: ['Cynthia Seow', 'Marcus Chiang'],
        commercial: [],
    },
    'CIMB': {
        residential: ['Daniel Lim', 'Kaethy Goh'],
        commercial: [],
    },
    'CITI': {
        residential: ['Gina Ng'],
        commercial: [],
    },
    'RHB': {
        residential: ['Megan Wong'],
        commercial: [],
    },
    'SBI': {
        residential: ['Narayanan Hariharan'],
        commercial: [],
    },
    'Singapura Finance': {
        residential: ['Chang-Ee'],
        commercial: [],
    },
    'Hong Leong Finance': {
        residential: ['Lim Chun Seng'],
        commercial: [],
    },
}

export const RESIDENTIAL_PROPERTY_TYPES = [
    'Resale HDB',
    'BTO',
    'Resale Condo',
    'New Launch Condo',
    'Resale Landed',
]

export const COMMERCIAL_PROPERTY_TYPES = [
    'Commercial',
    'Industrial',
]

export const FLOATING_RATE_TYPES = ['1MSORA', '3MSORA', 'FD Rate', 'Board Rate'] as const
export type FloatingRateType = typeof FLOATING_RATE_TYPES[number]

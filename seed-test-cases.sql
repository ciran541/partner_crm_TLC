-- Seed Test Cases for Partner Mortgage CRM
-- Run this in Supabase SQL Editor
-- IMPORTANT: Replace 'YOUR_USER_ID_HERE' with your actual user ID from auth.users

-- You can find your user ID by running:
-- SELECT id, email FROM auth.users;

-- Then replace the variable below:
DO $$
DECLARE
  user_id uuid := 'YOUR_USER_ID_HERE'; -- REPLACE THIS!
BEGIN

-- Test Case 1: Refinancing - Touched Base
INSERT INTO cases (
  created_by, case_type, client_name, client_mobile, client_email, 
  loan_size, stage, current_bank, existing_loan_amount, lock_in_end_date
) VALUES (
  user_id, 'Refinancing', 'John Tan', '+65 9123 4567', 'john.tan@email.com',
  500000, 'Touched Base', 'DBS', 480000, '2025-06-15'
);

-- Test Case 2: Purchase - Proposal Given
INSERT INTO cases (
  created_by, case_type, client_name, client_mobile, loan_size, stage,
  property_type, property_price
) VALUES (
  user_id, 'Purchase', 'Sarah Lim', '+65 8234 5678', 750000, 'Proposal Given',
  'Condo', 850000
);

-- Test Case 3: Refinancing - Referred to Bank
INSERT INTO cases (
  created_by, case_type, client_name, client_email, loan_size, stage,
  current_bank, existing_loan_amount, lock_in_end_date
) VALUES (
  user_id, 'Refinancing', 'Michael Wong', 'michael.w@email.com', 650000, 'Referred to Bank',
  'OCBC', 620000, '2024-12-31'
);

-- Test Case 4: Purchase - Pending Approval
INSERT INTO cases (
  created_by, case_type, client_name, client_mobile, client_email,
  loan_size, stage, property_type, property_price
) VALUES (
  user_id, 'Purchase', 'Emily Chen', '+65 9876 5432', 'emily.chen@email.com',
  900000, 'Pending Approval', 'Landed', 1200000
);

-- Test Case 5: Decouple - Pending Signature
INSERT INTO cases (
  created_by, case_type, client_name, loan_size, stage,
  property_type, property_price
) VALUES (
  user_id, 'Decouple', 'David & Rachel Lee', 550000, 'Pending Signature',
  'HDB', 450000
);

-- Test Case 6: Refinancing - Closed Won (with closure details)
INSERT INTO cases (
  created_by, case_type, client_name, client_mobile, client_email,
  loan_size, stage, current_bank, existing_loan_amount, lock_in_end_date,
  closed_package_details, closed_interest_rate, closed_tenure, 
  subsidy_provided, clawback_end_date, remarks
) VALUES (
  user_id, 'Refinancing', 'David Lee', '+65 9111 2222', 'david.lee@email.com',
  450000, 'Closed Won', 'UOB', 430000, '2024-08-20',
  'DBS 2-Year Fixed Package', 2.35, 25, 
  '$3,000 cash rebate', '2027-01-15', 'Client very satisfied with the rate. Smooth process.'
);

-- Test Case 7: Purchase - Closed Won (with closure details)
INSERT INTO cases (
  created_by, case_type, client_name, client_mobile, loan_size, stage,
  property_type, property_price,
  closed_package_details, closed_interest_rate, closed_tenure,
  subsidy_provided, clawback_end_date, remarks
) VALUES (
  user_id, 'Purchase', 'Rachel Ng', '+65 8333 4444', 800000, 'Closed Won',
  'HDB', 650000,
  'OCBC 3-Year Fixed Package', 2.48, 30,
  '$2,500 cash + legal subsidy', '2028-03-01', 'First-time buyer. Very happy with the outcome.'
);

-- Test Case 8: Equity Loan - Closed Won
INSERT INTO cases (
  created_by, case_type, client_name, loan_size, stage,
  property_type, property_price,
  closed_package_details, closed_interest_rate, closed_tenure,
  subsidy_provided, remarks
) VALUES (
  user_id, 'Equity Loan', 'James Koh', 300000, 'Closed Won',
  'Condo', 1100000,
  'Standard Chartered Equity Release', 3.15, 15,
  'No subsidy', 'Used for business expansion'
);

-- Test Case 9: Refinancing - Closed Lost
INSERT INTO cases (
  created_by, case_type, client_name, loan_size, stage,
  current_bank, existing_loan_amount, remarks
) VALUES (
  user_id, 'Refinancing', 'Lisa Tan', 550000, 'Closed Lost',
  'Standard Chartered', 540000, 'Client decided to stay with current bank due to relationship manager'
);

-- Test Case 10: Divorce - Touched Base
INSERT INTO cases (
  created_by, case_type, client_name, client_mobile, loan_size, stage,
  property_type, property_price
) VALUES (
  user_id, 'Divorce', 'Peter & Mary Lim', '+65 9555 6666', 680000, 'Touched Base',
  'HDB', 550000
);

-- Test Case 11: Purchase - Proposal Given (minimal data)
INSERT INTO cases (
  created_by, case_type, loan_size, stage
) VALUES (
  user_id, 'Purchase', 720000, 'Proposal Given'
);

-- Test Case 12: Refinancing - Touched Base (minimal data)
INSERT INTO cases (
  created_by, case_type, stage
) VALUES (
  user_id, 'Refinancing', 'Touched Base'
);

END $$;

-- Verify the data was inserted
SELECT 
  id, 
  client_name, 
  case_type, 
  loan_size, 
  stage,
  created_at
FROM cases
ORDER BY created_at DESC
LIMIT 12;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Ports lib/property/commission.ts for non-negative loan amounts. */
public class CommissionCalculator {
    private static final BigDecimal COMMISSION_RATE = new BigDecimal("0.0015");
    private static final BigDecimal AGENT_SHARE = new BigDecimal("0.90");
    private static final BigDecimal TLC_SHARE = new BigDecimal("0.10");

    // A record groups named values into an immutable result.
    public record Commission(BigDecimal gross, BigDecimal agent, BigDecimal tlc) {}

    public static Commission calculate(BigDecimal outstandingLoanAmount) {
        if (outstandingLoanAmount == null || outstandingLoanAmount.signum() < 0) {
            throw new IllegalArgumentException("Loan amount must be non-negative.");
        }

        BigDecimal gross = money(outstandingLoanAmount.multiply(COMMISSION_RATE));
        return new Commission(
            gross,
            money(gross.multiply(AGENT_SHARE)),
            money(gross.multiply(TLC_SHARE))
        );
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    public static void main(String[] args) {
        BigDecimal loan = new BigDecimal(args.length == 0 ? "1000000" : args[0]);
        Commission result = calculate(loan);
        System.out.println("Loan:  " + loan.toPlainString());
        System.out.println("Gross: " + result.gross().toPlainString());
        System.out.println("Agent: " + result.agent().toPlainString());
        System.out.println("TLC:   " + result.tlc().toPlainString());
    }
}

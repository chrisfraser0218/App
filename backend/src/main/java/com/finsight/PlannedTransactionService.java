package com.finsight;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.util.*;
import java.time.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import static com.finsight.ForecastModels.*;

@Service @Transactional(readOnly=true)
class PlannedTransactionService {
    private final PlannedTransactionRepository plans;
    private final AccountRepository accounts;
    private final CategoryRepository categories;
    private final TransactionRepository transactions;
    private final FinanceService finance;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    PlannedTransactionService(PlannedTransactionRepository plans,AccountRepository accounts,CategoryRepository categories,
        TransactionRepository transactions,FinanceService finance,JdbcTemplate jdbc,Clock clock) {
        this.plans=plans;this.accounts=accounts;this.categories=categories;this.transactions=transactions;
        this.finance=finance;this.jdbc=jdbc;this.clock=clock;
    }
    List<PlanView> list() { return plans.findByUserIdAndAccountIdOrderByPlannedDateAscCreatedAtAsc(CurrentIdentity.userId(),CurrentIdentity.accountId()).stream().map(this::view).toList(); }
    @Transactional PlanView create(PlanInput input) {
        accounts.lockOwned(CurrentIdentity.accountId(),CurrentIdentity.userId()).orElseThrow(()->error(HttpStatus.NOT_FOUND,"Account not found"));
        String fingerprint=hash(input.description().strip(),input.amount().stripTrailingZeros().toPlainString(),input.type(),input.categoryId(),input.date());
        var previous=plans.findByUserIdAndRequestId(CurrentIdentity.userId(),input.requestId());
        if(previous.isPresent()) {
            if(!previous.get().creationFingerprint.equals(fingerprint))throw error(HttpStatus.CONFLICT,"Request ID already belongs to a different plan");
            return view(previous.get());
        }
        validate(input);
        PlannedTransaction p=new PlannedTransaction();p.id=UUID.randomUUID();p.userId=CurrentIdentity.userId();p.accountId=CurrentIdentity.accountId();
        p.requestId=input.requestId();p.creationFingerprint=fingerprint;p.status="PLANNED";p.createdAt=clock.instant();apply(p,input);
        return view(plans.saveAndFlush(p));
    }
    @Transactional PlanView update(UUID id,PlanUpdate update) {
        PlannedTransaction p=owned(id);checkVersion(p,update.version());checkOpen(p);validate(update.plan());
        if(!p.requestId.equals(update.plan().requestId()))throw error(HttpStatus.BAD_REQUEST,"Request ID cannot change");
        apply(p,update.plan());return view(plans.saveAndFlush(p));
    }
    @Transactional PlanView cancel(UUID id,VersionInput input) {
        PlannedTransaction p=owned(id);checkVersion(p,input.version());checkOpen(p);p.status="CANCELED";return view(plans.saveAndFlush(p));
    }
    @Transactional PlanView complete(UUID id,CompletionInput input) {
        PlannedTransaction p=owned(id);
        String fingerprint=hash(input.mode(),String.valueOf(input.transactionId()),String.valueOf(input.recordedDate()),input.confirmAmountDifference());
        if(p.status.equals("COMPLETED")&&input.requestId().equals(p.completionRequestId)&&fingerprint.equals(p.completionFingerprint))return view(p);
        checkVersion(p,input.version());checkOpen(p);
        if(input.mode()==CompletionMode.RECORD) {
            if(input.transactionId()!=null)throw error(HttpStatus.BAD_REQUEST,"Recording does not accept an existing transaction ID");
            if(p.plannedDate.isAfter(today()))throw error(HttpStatus.BAD_REQUEST,"A future plan cannot automatically be recorded. Link an actual early payment explicitly instead");
            LocalDate date=input.recordedDate()==null?today():input.recordedDate();
            if(date.isAfter(today())||date.isBefore(LocalDate.of(1900,1,1)))throw error(HttpStatus.BAD_REQUEST,"Choose an actual date from 1900 through today");
            var result=finance.create(new ApiModels.TransactionInput(p.description,p.amount,p.type,p.categoryId,date,null));
            p.transactionId=result.id();
        } else if(input.mode()==CompletionMode.LINK) {
            if(input.transactionId()==null||input.recordedDate()!=null)throw error(HttpStatus.BAD_REQUEST,"Choose an existing payment; its date stays unchanged");
            Transaction t=transactions.lockOwned(input.transactionId(),p.userId,p.accountId).orElseThrow(()->error(HttpStatus.NOT_FOUND,"Transaction not found"));
            if(t.type!=p.type)throw error(HttpStatus.BAD_REQUEST,"Payment direction must match the plan");
            if(t.amount.compareTo(p.amount)!=0&&!input.confirmAmountDifference())throw error(HttpStatus.BAD_REQUEST,"Confirm the recorded amount differs from the plan");
            if(jdbc.queryForObject("SELECT COUNT(*) FROM planned_transactions WHERE transaction_id = ?",Integer.class,t.id)>0)
                throw error(HttpStatus.CONFLICT,"This payment is already linked to a completed plan");
            p.transactionId=t.id;
        } else {
            if(input.transactionId()!=null||input.recordedDate()!=null)throw error(HttpStatus.BAD_REQUEST,"Handled-only completion does not record or link money");
        }
        p.status="COMPLETED";p.completionMode=input.mode().name();p.completionRequestId=input.requestId();
        p.completionFingerprint=fingerprint;p.completedAt=clock.instant();return view(plans.saveAndFlush(p));
    }
    private void validate(PlanInput input) {
        if(!input.date().isAfter(today())||input.date().getYear()>9999)throw error(HttpStatus.BAD_REQUEST,"Planned date must be after today, within year 9999");
        var category=categories.findByIdAndUserId(input.categoryId(),CurrentIdentity.userId()).orElseThrow(()->error(HttpStatus.BAD_REQUEST,"Choose a valid category"));
        if(category.type!=input.type())throw error(HttpStatus.BAD_REQUEST,"Category must match income or expense");
    }
    private void apply(PlannedTransaction p,PlanInput input) { p.description=input.description().strip();p.amount=input.amount();p.type=input.type();p.categoryId=input.categoryId();p.plannedDate=input.date(); }
    private PlannedTransaction owned(UUID id) {return plans.lockOwned(id,CurrentIdentity.userId(),CurrentIdentity.accountId()).orElseThrow(()->error(HttpStatus.NOT_FOUND,"Planned transaction not found"));}
    private void checkOpen(PlannedTransaction p) {if(!p.status.equals("PLANNED"))throw error(HttpStatus.CONFLICT,"Only open plans can be changed or completed");}
    private void checkVersion(PlannedTransaction p,long version) {if(p.version!=version)throw error(HttpStatus.CONFLICT,"Plan changed. Refresh before trying again");}
    private LocalDate today(){return LocalDate.now(clock);}
    private PlanView view(PlannedTransaction p){return new PlanView(p.id,p.description,p.amount.toPlainString(),p.type,p.categoryId,p.plannedDate,p.status,p.requestId,p.version,p.transactionId,p.completionMode,p.status.equals("PLANNED")&&p.plannedDate.isBefore(today()));}
    private String hash(Object... fields) {
        try {StringBuilder s=new StringBuilder();for(Object field:fields){String v=String.valueOf(field);s.append(v.length()).append(':').append(v);}return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.toString().getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    private ResponseStatusException error(HttpStatus status,String detail){return new ResponseStatusException(status,detail);}
}

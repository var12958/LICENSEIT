/// Append-only log of licensed reads from LICENSEIT.
///
/// Each read emits one event. Nothing is stored mutably, because an audit log
/// that can be edited proves nothing. Events are permanent in the transaction
/// history, so a read logged here cannot later be revised or removed, and the
/// absence of an event for a file is itself evidence.
module receipt_log::receipt_log {
    use std::signer;
    use std::string::String;
    use aptos_framework::event;
    use aptos_framework::timestamp;

    /// blob_hash was empty. A receipt that does not name what was served is not a receipt.
    const E_EMPTY_BLOB_HASH: u64 = 1;
    /// license_id was empty. A read with no license reference cannot be audited.
    const E_EMPTY_LICENSE_ID: u64 = 2;
    /// training_run_id was empty. A read that belongs to no run cannot be reported on.
    const E_EMPTY_TRAINING_RUN_ID: u64 = 3;

    #[event]
    struct ReadLogged has drop, store {
        /// Blob merkle root recomputed from the bytes Shelby served.
        blob_hash: vector<u8>,
        license_id: String,
        /// Always the transaction signer, see log_read.
        reader: address,
        training_run_id: String,
        /// Chain time, not the caller's clock.
        timestamp_us: u64,
    }

    #[event]
    struct AccessLogged has drop, store {
        blob_hash: vector<u8>,
        license_id: String,
        reader: address,
        training_run_id: String,
        operation: String,
        timestamp_us: u64,
    }

    /// Records one read. The reader address is derived from the signer rather than
    /// taken as an argument, so a caller cannot log a read under someone else's
    /// identity. The timestamp comes from the chain for the same reason: a caller
    /// with a wrong or dishonest clock cannot place a read outside its license
    /// window.
    public entry fun log_read(
        account: &signer,
        blob_hash: vector<u8>,
        license_id: String,
        training_run_id: String,
    ) {
        assert!(!blob_hash.is_empty(), E_EMPTY_BLOB_HASH);
        assert!(!license_id.is_empty(), E_EMPTY_LICENSE_ID);
        assert!(!training_run_id.is_empty(), E_EMPTY_TRAINING_RUN_ID);

        event::emit(ReadLogged {
            blob_hash,
            license_id,
            reader: signer::address_of(account),
            training_run_id,
            timestamp_us: timestamp::now_microseconds(),
        });
    }

    /// Records one controlled access with explicit operation authorization.
    public entry fun log_access(
        account: &signer,
        blob_hash: vector<u8>,
        license_id: String,
        training_run_id: String,
        operation: String,
    ) {
        assert!(!blob_hash.is_empty(), E_EMPTY_BLOB_HASH);
        assert!(!license_id.is_empty(), E_EMPTY_LICENSE_ID);
        assert!(!training_run_id.is_empty(), E_EMPTY_TRAINING_RUN_ID);

        event::emit(AccessLogged {
            blob_hash,
            license_id,
            reader: signer::address_of(account),
            training_run_id,
            operation,
            timestamp_us: timestamp::now_microseconds(),
        });
    }


    #[test_only]
    use std::string;
    #[test_only]
    use aptos_framework::account;

    #[test_only]
    /// timestamp::now_microseconds aborts unless the CurrentTimeMicroseconds
    /// resource exists, which only the framework account can create.
    fun set_up_chain_time(framework: &signer, now_us: u64) {
        timestamp::set_time_has_started_for_testing(framework);
        timestamp::update_global_time_for_test(now_us);
    }

    #[test(framework = @aptos_framework, reader = @0xa11ce)]
    fun log_read_emits_one_event(framework: &signer, reader: &signer) {
        set_up_chain_time(framework, 1_700_000_000_000_000);
        account::create_account_for_test(signer::address_of(reader));

        log_read(
            reader,
            x"329a2fec6d645d1a85e9a47a5f2e8e94fb3fc7bfec207f2aa868ddb7e4580947",
            string::utf8(b"LIC-SPRINT2-001"),
            string::utf8(b"run-sprint4"),
        );

        assert!(event::emitted_events<ReadLogged>().length() == 1, 0);
    }

    #[test(framework = @aptos_framework, reader = @0xa11ce)]
    /// The point of the module: the logged reader is the signer, so read
    /// attribution cannot be forged by a caller passing an arbitrary address.
    fun logged_reader_is_the_signer(framework: &signer, reader: &signer) {
        set_up_chain_time(framework, 1_700_000_000_000_000);
        account::create_account_for_test(signer::address_of(reader));

        log_read(
            reader,
            x"01",
            string::utf8(b"LIC-1"),
            string::utf8(b"run-1"),
        );

        let logged = event::emitted_events<ReadLogged>();
        assert!(logged[0].reader == signer::address_of(reader), 0);
        assert!(logged[0].timestamp_us == 1_700_000_000_000_000, 1);
    }

    #[test(framework = @aptos_framework, reader = @0xa11ce)]
    #[expected_failure(abort_code = E_EMPTY_BLOB_HASH)]
    fun log_read_rejects_empty_blob_hash(framework: &signer, reader: &signer) {
        set_up_chain_time(framework, 1_700_000_000_000_000);
        log_read(
            reader,
            x"",
            string::utf8(b"LIC-1"),
            string::utf8(b"run-1"),
        );
    }

    #[test(framework = @aptos_framework, reader = @0xa11ce)]
    #[expected_failure(abort_code = E_EMPTY_LICENSE_ID)]
    fun log_read_rejects_empty_license_id(framework: &signer, reader: &signer) {
        set_up_chain_time(framework, 1_700_000_000_000_000);
        log_read(
            reader,
            x"01",
            string::utf8(b""),
            string::utf8(b"run-1"),
        );
    }

    #[test(framework = @aptos_framework, reader = @0xa11ce)]
    #[expected_failure(abort_code = E_EMPTY_TRAINING_RUN_ID)]
    fun log_read_rejects_empty_training_run_id(framework: &signer, reader: &signer) {
        set_up_chain_time(framework, 1_700_000_000_000_000);
        log_read(
            reader,
            x"01",
            string::utf8(b"LIC-1"),
            string::utf8(b""),
        );
    }
}

import express from "express";
import cors from "cors";

import serviceRoute from "./routes/service.route";
import customerRoute from "./routes/customer.route";
import vehicleRoute from "./routes/vehicle.route";
import staffRoute from "./routes/staff.route";
import orderRoute from "./routes/order.route"
import { errorHandler } from "./middlewares/error.middleware";
import authRoute from "./routes/auth.route";
import paymentRoute from "./routes/payment.route";
import invoiceRoute from "./routes/invoice.route";



const app = express();

app.use(cors());

app.use(express.json());
app.use("/api/auth", authRoute);
app.use("/api/services", serviceRoute);
app.use("/api/customers", customerRoute);
app.use("/api/vehicles", vehicleRoute);
app.use("/api/staffs", staffRoute);
app.use("/api/orders", orderRoute);
app.use("/api/payments", paymentRoute);
app.use("/api/invoices", invoiceRoute);

app.use(errorHandler);

app.listen(5000, () => {
    console.log("Server Running");
});
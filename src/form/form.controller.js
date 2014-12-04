jQuery.sap.declare("inspur.gsp.rt.form.form")

sap.ui.core.mvc.Controller.extend("inspur.gsp.rt.form.form", {

	onBt1Click:function(e) {
		var data = this.getView().getModel("oModel").getData();
		alert("Model : name " + data.name + " key " + data.key);
		// var oView = this.getView();
		// var oModel = this.getView().getModel("oModel");
		// oView.setModel(oModel);
		// var myName = this.byId("name").getValue();
		// oModel.getData().name = myName;
		// oModel.refresh();
	},

	Init:function(){
	},

})